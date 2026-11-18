// The "tools" nav badge: enabled-mod conflicts, problems and mods a game update broke, for the current game, that
// haven't been looked at yet. The overlays and the Tools panels each report the part they loaded, as one key per
// conflict, problem or broken mod. A Tools page marks only what it lists as seen, and so does the mod a key is about,
// so the badge is only about what is new. A problem that can't be fixed doesn't sit there forever. The Tools page
// list shows each page's own share of the count. Owner: MODTOOLS area.
import { useSyncExternalStore } from "react";
import { backups, library, modtools, type ConflictGroup, type GameId } from "../../lib/api";
import { oxford } from "../../lib/notes";
import { jsonPref } from "../../lib/prefs";
import { currentGame, currentRoute, emitApp, setBadge } from "../../lib/store";
import { record } from "../../lib/history";
import { t, tb, tn } from "../../lib/i18n";

type Part = "conflicts" | "problems" | "fixes";
const parts: Record<Part, string[]> = { conflicts: [], problems: [], fixes: [] };
/** The Tools page each part is listed on. */
const PART_PAGE: Record<Part, string> = { conflicts: "conflicts", problems: "problems", fixes: "problems" };
const partOf = (k: string): Part => (k.startsWith("c|") ? "conflicts" : k.startsWith("f|") ? "fixes" : "problems");
const allKeys = () => [...parts.conflicts, ...parts.problems, ...parts.fixes];
let forGame: GameId | null = null;
/** The Tools page showing now, or null when Tools isn't open. */
let toolsPage: string | null = null;
/** Keys already looked at, per game. */
const seenPref = jsonPref<Record<string, string[]>>("tools.seen", {});

/** One conflict's key: the mods in it. */
export const conflictKey = (g: ConflictGroup) => `c|${g.mods.map((m) => m.modId).sort().join("+")}`;
/** One problem's key. `id` is what tells it from the mod's other problems. */
export const problemSeenKey = (modId: string, id: string) => `p|${modId}|${id}`;
/** A mod a game update broke. */
export const fixSeenKey = (modId: string) => `f|${modId}`;

// new items per Tools page, for the page list
const NO_COUNTS: Record<string, number> = {};
let pageCounts = NO_COUNTS;
const subs = new Set<() => void>();
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** How many new items each Tools page has, by page id. */
export const useToolsCounts = () => useSyncExternalStore(subscribe, () => pageCounts);

function show() {
  if (!forGame) return;
  const seen = new Set(seenPref.get()[forGame] ?? []);
  const fresh = allKeys().filter((k) => !seen.has(k));
  setBadge("tools", fresh.length ? { count: fresh.length, tone: "bad" } : null);
  const next: Record<string, number> = {};
  for (const k of fresh) { const pg = PART_PAGE[partOf(k)]; next[pg] = (next[pg] ?? 0) + 1; }
  const same = Object.keys(next).length === Object.keys(pageCounts).length && Object.entries(next).every(([k, v]) => pageCounts[k] === v);
  if (!same) { pageCounts = next; subs.forEach((f) => f()); }
}

/** Save what has been looked at. Keys of things that are gone are dropped, so one that comes back counts again. */
function markSeen(game: GameId, pick: (key: string) => boolean) {
  if (forGame !== game) return;
  const now = allKeys();
  const before = seenPref.get()[game] ?? [];
  const next = now.filter((k) => before.includes(k) || pick(k));
  if (next.length === before.length && next.every((k) => before.includes(k))) return;
  void seenPref.set({ ...seenPref.get(), [game]: next }).then(show);
}

/** A Tools page is showing: what it lists has been seen. With no page given, the one showing now. */
export const markToolsSeen = (game: GameId, page: string | null = toolsPage) => {
  if (page) markSeen(game, (k) => PART_PAGE[partOf(k)] === page);
};
/** Tools shows this page now (null: Tools closed). Its items count as seen. */
export function setToolsPage(game: GameId, page: string | null) {
  toolsPage = page;
  if (page) markToolsSeen(game, page);
}
/** A mod's details are open: its problems, conflicts and game update breakage have been seen. */
export const markModSeen = (game: GameId, modId: string) =>
  markSeen(game, (k) => (k.startsWith("c|") ? k.slice(2).split("+").includes(modId) : k.split("|")[1] === modId));

/** Report one part of the count. Results for a game that is no longer current are ignored. */
export function setToolsCount(game: GameId, part: Part, keys: string[]) {
  if (currentGame()?.id !== game) return;
  if (forGame !== game) { parts.conflicts = []; parts.problems = []; parts.fixes = []; forGame = game; }
  parts[part] = keys;
  void seenPref.ready.then(() => {
    if (forGame !== game) return;
    const r = currentRoute();
    // looking at it right now
    if (r.view === "tools") markToolsSeen(game);
    else if ("modId" in r && typeof r.modId === "string") markModSeen(game, r.modId);
    show();
  });
}

/** Turn mods off with Undo. Returns once they are off. */
export async function turnOff(game: GameId, ids: string[], names: string[]) {
  if (!ids.length) return;
  const set = async (on: boolean) => { await library.setEnabled(game, ids, on); emitApp({ type: "library-refresh", game }); };
  await set(false);
  const label = names.length === 1 ? t("Turned off {name}", { name: names[0]! }) : tn(names.length, "Turned off {n} mod", "Turned off {n} mods");
  record({ label, brief: names.length === 1 ? t("Turned off the other mod") : undefined, undo: () => set(true), redo: () => set(false) });
}

/** Ignore the conflict between these mods (nothing in them changes), or stop ignoring it. With Undo. */
export async function ignoreConflict(game: GameId, ids: string[], names: string[], on = true) {
  const set = async (v: boolean) => { await modtools.ignoreConflict(game, ids, v); emitApp({ type: "library-refresh", game }); };
  await set(on);
  record({
    label: on ? t("Ignored the conflict between {names}", { names: oxford(names) }) : t("Stopped ignoring {names}", { names: oxford(names) }),
    brief: on ? t("Ignored the conflict") : t("Showing the conflict again"),
    undo: () => set(!on), redo: () => set(on),
  });
}

/** Take the shared parts out of one mod, so the other mods show them. With Undo (the backup puts them back). */
export async function dropShared(game: GameId, id: string, hashes: string[]) {
  let backup = await modtools.dropShared(game, id, hashes);
  emitApp({ type: "library-refresh", game });
  const flip = async () => { backup = await backups.restore(backup.id); emitApp({ type: "library-refresh", game }); };
  record({ label: tb(backup.label), brief: t("Took the shared parts out of the mod"), undo: flip, redo: flip });
}

/** A file name Windows accepts ("Ellen: skins?" -> "Ellen skins"). */
export function fileName(s: string): string {
  const clean = s.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  return clean || "mods";
}
