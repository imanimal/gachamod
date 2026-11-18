// Problems in mods (modtools.lint): one result per game that the Tools panel, the Tools page order and the nav badge
// all read, the problems the user chose to ignore, and the one-click fixes. Owner: MODTOOLS area.
import { useMemo, useSyncExternalStore } from "react";
import { errorKind, errorText, modtools, type Backup, type GameId, type ModProblems, type Problem, type ProblemFix } from "../../lib/api";
import { modPage, newestFile, queueModFile } from "../../lib/gamebanana";
import { holdsNow, holdsPref, releaseMods } from "../../lib/holds";
import { jsonPref } from "../../lib/prefs";
import { emitApp, go } from "../../lib/store";
import { onKeysChanged, recordBackups } from "../../ui/KeyEditor";
import { t, tb, tn } from "../../lib/i18n";
import { toast } from "../../ui/toast";
import { problemSeenKey } from "./toolsBadge";

// ── ignoring ──

/** Ignored problems by "<game>:<modId>". A problem that changes (another file goes missing) shows again. */
export const ignoredPref = jsonPref<Record<string, string[]>>("problems.ignored", {});
export type Ignored = Record<string, string[]>;
/** The ignored problems; a new object when a mod's problems are set aside from the Mods list too (lib/holds). */
export function useIgnored(): Ignored {
  const ign = ignoredPref.use();
  const holds = holdsPref.use();
  return useMemo(() => ({ ...ign }), [ign, holds]);
}

const problemKey = (p: Problem) => `${p.kind}|${p.ini ?? ""}|${p.detail}`;
const modKey = (game: GameId, modId: string) => `${game}:${modId}`;
const isIgnored = (ign: Ignored, game: GameId, modId: string, p: Problem) =>
  holdsNow(game)[modId]?.kind === "ignore" || !!ign[modKey(game, modId)]?.includes(problemKey(p));

/** What Tools lists for a mod: warnings and worse, not ignored. Notes ("info") only show in the mod's drawer. */
export const shownProblems = (ign: Ignored, game: GameId, m: ModProblems) =>
  m.problems.filter((p) => p.severity !== "info" && !isIgnored(ign, game, m.modId, p));
/** Problems of a mod the user ignored (warnings and worse). */
export const ignoredProblems = (ign: Ignored, game: GameId, m: ModProblems) =>
  m.problems.filter((p) => p.severity !== "info" && isIgnored(ign, game, m.modId, p));

/** The nav badge's part: broken parts of mods that are on, not ignored, one key each (toolsBadge.ts). Warnings and
 *  mods that are off don't count. */
export const badgeKeys = (list: ModProblems[], ign: Ignored, game: GameId) =>
  list.flatMap((m) => (m.enabled ? shownProblems(ign, game, m).filter((p) => p.severity === "bad").map((p) => problemSeenKey(m.modId, problemKey(p))) : []));

/** A missing file or broken part with no fix in the mod's files: downloading the mod again may bring the file back. */
export const needsDownload = (shown: Problem[]) => shown.some((p) => !p.fix && (p.severity === "bad" || p.kind === "missing_file"));

export function ignore(game: GameId, m: ModProblems, problems: Problem[]) {
  if (!problems.length) return;
  const all = { ...ignoredPref.get() };
  const k = modKey(game, m.modId);
  all[k] = [...new Set([...(all[k] ?? []), ...problems.map(problemKey)])];
  void ignoredPref.set(all, tn(problems.length, "Ignored {n} problem in {name}", "Ignored {n} problems in {name}", { name: m.name }),
    tn(problems.length, "Ignored {n} problem in the mod", "Ignored {n} problems in the mod"));
}

export function ignoreAll(game: GameId, list: ModProblems[]) {
  const all = { ...ignoredPref.get() };
  let n = 0;
  for (const m of list) {
    const shown = shownProblems(all, game, m);
    if (!shown.length) continue;
    const k = modKey(game, m.modId);
    all[k] = [...new Set([...(all[k] ?? []), ...shown.map(problemKey)])];
    n += shown.length;
  }
  if (n) void ignoredPref.set(all, tn(n, "Ignored {n} problem", "Ignored {n} problems"), true);
}

export function unignore(game: GameId, m: ModProblems) {
  if (holdsNow(game)[m.modId]) void releaseMods(game, [{ id: m.modId, name: m.name }]);
  const all = { ...ignoredPref.get() };
  if (!all[modKey(game, m.modId)]) return;
  delete all[modKey(game, m.modId)];
  void ignoredPref.set(all, t("Showing {name}'s problems again", { name: m.name }), t("Showing the mod's problems again"));
}

// ── the lint result, one per game ──

type Snap = { game: GameId | null; list: ModProblems[] | null };
let snap: Snap = { game: null, list: null };
const subs = new Set<() => void>();
const set = (s: Snap) => { snap = s; subs.forEach((f) => f()); };
const loading = new Map<GameId, Promise<void>>();

/** The last lint result for `game`, or null until it has loaded. */
export function useLint(game: GameId | null): ModProblems[] | null {
  const s = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => snap);
  return game && s.game === game ? s.list : null;
}

/** Scan `game`'s mods for problems. `loud`: say so when it fails (the Tools panel asked); the badge stays quiet. */
export function loadLint(game: GameId, loud = false): Promise<void> {
  const busy = loading.get(game);
  if (busy) return busy;
  const job = modtools.lint(game)
    .then((list) => set({ game, list }))
    .catch((e) => {
      if (loud && errorKind(e) !== "todo") toast(errorText(e), true);
      if (snap.game !== game || !snap.list) set({ game, list: [] });
    })
    .finally(() => loading.delete(game));
  loading.set(game, job);
  return job;
}

// a fix, or its Undo, changed a mod's files: check that game again
onKeysChanged((game) => { if (snap.game === game) void loadLint(game); });

// ── fixing ──

/** Short button text for a fix ("Use RegularRaiden/x.buf", "Keep 1/Yelan.ini on"). */
export function fixLabel(f: ProblemFix): string {
  if (f.kind === "keep") { const ini = f.ini ?? f.inis[0]; return ini ? t("Keep {ini} on", { ini }) : t("Keep one on"); }
  if (f.kind === "off") return t("Turn this copy off");
  const to = (f.to ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
  return t("Use {file}", { file: to });
}

export function fixHint(f: ProblemFix): string {
  if (f.kind === "keep") return t("Turn off the others by renaming them DISABLED_. Undo puts them back");
  if (f.kind === "off") return t("Renames {ini} DISABLED_, so the loader uses the other copy. Undo puts it back", { ini: f.ini ?? "" });
  return t("The same file is at {file}. Changes {ini} to load it from there. Undo puts the old line back", { file: (f.to ?? "").replace(/\\/g, "/"), ini: f.ini ?? "" });
}

/** Make a fix, with Undo. True when it worked. */
export async function applyFix(game: GameId, m: ModProblems, fix: ProblemFix): Promise<boolean> {
  try {
    const backup = await modtools.fix(game, m.modId, fix);
    recordBackups(t("{name}: {what}", { name: m.name, what: tb(backup.label) }), [{ game, modId: m.modId, backup }], { brief: t("Fixed the problem in the mod") });
    return true;
  } catch (e) {
    toast(errorText(e), true);
    return false;
  } finally {
    emitApp({ type: "library-refresh", game });
    void loadLint(game);
  }
}

/** Fixes "Fix all" makes: every one that needs no choice ("keep" asks which variant stays). */
export const autoFixes = (list: ModProblems[], ign: Ignored, game: GameId) =>
  list.flatMap((m) => shownProblems(ign, game, m).filter((p) => p.fix && p.fix.kind !== "keep").map((p) => ({ m, fix: p.fix! })));

/** Make every automatic fix, as one Undo step. */
export async function fixAll(game: GameId, list: ModProblems[], ign: Ignored) {
  const taken: Array<{ game: string; modId: string; backup: Backup }> = [];
  let failed: unknown = null;
  for (const { m, fix } of autoFixes(list, ign, game)) {
    try { taken.push({ game, modId: m.modId, backup: await modtools.fix(game, m.modId, fix) }); } catch (e) { failed ??= e; }
  }
  if (taken.length) {
    const fixed = tn(taken.length, "Fixed {n} problem", "Fixed {n} problems");
    recordBackups(taken.length === 1 ? tb(taken[0]!.backup.label) : fixed, taken, { brief: fixed });
  }
  if (failed) toast(errorText(failed), true);
  emitApp({ type: "library-refresh", game });
  void loadLint(game);
}

/** Download the mod's GameBanana file again (the same file when it is still there, else the newest). Its settings
 *  stay, like any update. */
export async function downloadAgain(game: GameId, m: ModProblems) {
  const s = m.source;
  if (!s) return;
  try {
    const mod = await modPage(s.modId);
    if (!mod) { toast(t("Couldn't find the mod on GameBanana"), true); return; }
    const file = mod.files.find((f) => f.id === s.fileId) ?? newestFile(mod);
    if (!file) { toast(t("The mod has no file to download on GameBanana"), true); return; }
    await queueModFile(game, mod, file, m.modId);
    toast(t("Downloading the mod again"), false, { label: t("Show"), run: () => go("downloads") });
  } catch (e) { toast(errorText(e), true); }
}

/** Look for the mod on GameBanana by name (it isn't linked to a page). */
export const findOnline = (m: ModProblems) => go({ view: "browse", search: m.name });
