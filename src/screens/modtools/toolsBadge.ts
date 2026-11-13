// The "tools" nav badge: enabled-mod conflicts plus problems for the current game. The overlays and the Tools panels
// each report the part they loaded. Owner: MODTOOLS area.
import { library, type GameId, type ModProblems } from "../../lib/api";
import { currentGame, setBadge } from "../../lib/store";
import { record } from "../../lib/history";

const parts = { conflicts: 0, problems: 0 };
let forGame: GameId | null = null;

/** Report one part of the count. Results for a game that is no longer current are ignored. */
export function setToolsCount(game: GameId, part: keyof typeof parts, n: number) {
  if (currentGame()?.id !== game) return;
  if (forGame !== game) { parts.conflicts = 0; parts.problems = 0; forGame = game; }
  parts[part] = n;
  const total = parts.conflicts + parts.problems;
  setBadge("tools", total ? { count: total, tone: "bad" } : null);
}

/** Problems that matter (not the "info" ones). */
export const problemCount = (list: ModProblems[]) => list.reduce((s, m) => s + m.problems.filter((p) => p.severity !== "info").length, 0);

/** Turn mods off with Undo. Returns once they are off. */
export async function turnOff(game: GameId, ids: string[], names: string[]) {
  if (!ids.length) return;
  await library.setEnabled(game, ids, false);
  const label = names.length === 1 ? `Turned off ${names[0]}` : `Turned off ${names.length} mods`;
  record({ label, undo: () => library.setEnabled(game, ids, true), redo: () => library.setEnabled(game, ids, false) });
}

/** A file name Windows accepts ("Ellen: skins?" -> "Ellen skins"). */
export function fileName(s: string): string {
  const t = s.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  return t || "mods";
}
