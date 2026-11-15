// The "tools" nav badge: enabled-mod conflicts plus problems for the current game that haven't been looked at yet.
// The overlays and the Tools panels each report the part they loaded, as one key per conflict or problem. Opening
// Tools, or the mod a problem is in, marks them seen, so the badge is only about what is new. A problem that can't
// be fixed doesn't sit there forever. Owner: MODTOOLS area.
import { backups, library, modtools, type ConflictGroup, type GameId } from "../../lib/api";
import { oxford } from "../../lib/notes";
import { jsonPref } from "../../lib/prefs";
import { currentGame, currentRoute, emitApp, setBadge } from "../../lib/store";
import { record } from "../../lib/history";

const parts: Record<"conflicts" | "problems", string[]> = { conflicts: [], problems: [] };
let forGame: GameId | null = null;
/** Keys already looked at, per game. */
const seenPref = jsonPref<Record<string, string[]>>("tools.seen", {});

/** One conflict's key: the mods in it. */
export const conflictKey = (g: ConflictGroup) => `c|${g.mods.map((m) => m.modId).sort().join("+")}`;
/** One problem's key. `id` is what tells it from the mod's other problems. */
export const problemSeenKey = (modId: string, id: string) => `p|${modId}|${id}`;

function show() {
  if (!forGame) return;
  const seen = new Set(seenPref.get()[forGame] ?? []);
  const fresh = [...parts.conflicts, ...parts.problems].filter((k) => !seen.has(k)).length;
  setBadge("tools", fresh ? { count: fresh, tone: "bad" } : null);
}

/** Save what has been looked at. Keys of things that are gone are dropped, so one that comes back counts again. */
function markSeen(game: GameId, pick: (key: string) => boolean) {
  if (forGame !== game) return;
  const now = [...parts.conflicts, ...parts.problems];
  const before = seenPref.get()[game] ?? [];
  const next = now.filter((k) => before.includes(k) || pick(k));
  if (next.length === before.length && next.every((k) => before.includes(k))) return;
  void seenPref.set({ ...seenPref.get(), [game]: next }).then(show);
}

/** Tools is open: everything it lists has been seen. */
export const markToolsSeen = (game: GameId) => markSeen(game, () => true);
/** A mod's details are open: its problems and conflicts have been seen. */
export const markModSeen = (game: GameId, modId: string) =>
  markSeen(game, (k) => (k.startsWith("p|") ? k.startsWith(`p|${modId}|`) : k.slice(2).split("+").includes(modId)));

/** Report one part of the count. Results for a game that is no longer current are ignored. */
export function setToolsCount(game: GameId, part: keyof typeof parts, keys: string[]) {
  if (currentGame()?.id !== game) return;
  if (forGame !== game) { parts.conflicts = []; parts.problems = []; forGame = game; }
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
  await library.setEnabled(game, ids, false);
  const label = names.length === 1 ? `Turned off ${names[0]}` : `Turned off ${names.length} mods`;
  record({ label, undo: () => library.setEnabled(game, ids, true), redo: () => library.setEnabled(game, ids, false) });
}

/** Ignore the conflict between these mods (nothing in them changes), or stop ignoring it. With Undo. */
export async function ignoreConflict(game: GameId, ids: string[], names: string[], on = true) {
  const set = async (v: boolean) => { await modtools.ignoreConflict(game, ids, v); emitApp({ type: "library-refresh", game }); };
  await set(on);
  record({ label: on ? `Ignored the conflict between ${oxford(names)}` : `Stopped ignoring ${oxford(names)}`, undo: () => set(!on), redo: () => set(on) });
}

/** Take the shared parts out of one mod, so the other mods show them. With Undo (the backup puts them back). */
export async function dropShared(game: GameId, id: string, hashes: string[]) {
  let backup = await modtools.dropShared(game, id, hashes);
  emitApp({ type: "library-refresh", game });
  const flip = async () => { backup = await backups.restore(backup.id); emitApp({ type: "library-refresh", game }); };
  record({ label: backup.label, undo: flip, redo: flip });
}

/** A file name Windows accepts ("Ellen: skins?" -> "Ellen skins"). */
export function fileName(s: string): string {
  const t = s.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  return t || "mods";
}
