// Broken mods no fix here will help (lib/fixes isDeadEnd): turn them off and wait for an update from their author
// (lib/holds), all at once, by hand from Tools > Fixes or by itself after each check when "fixes.autoMute" is on.
// Owner: FIXES area.
import { errorText, library, type GameId, type ModHealthRow } from "../../lib/api";
import { autoMutePref, fixWarningsPref, isDeadEnd, onHealth } from "../../lib/fixes";
import { holdMods, holdsNow, holdsPref, releaseMods } from "../../lib/holds";
import { record } from "../../lib/history";
import { plural } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { publish, restoreStates } from "../library/data";

/** Turn these mods off and wait for an update to them, as one Undo step. */
export async function muteDeadEnds(game: GameId, rows: ModHealthRow[]) {
  if (!rows.length) return;
  const refs = rows.map((r) => ({ id: r.modId, name: r.name }));
  const offIds = rows.filter((r) => r.enabled).map((r) => r.modId);
  const before = new Map(rows.map((r) => [r.modId, r.enabled]));
  let changed: string[] = [];
  let held: Awaited<ReturnType<typeof holdMods>> = null;
  try {
    if (offIds.length) {
      const change = await library.setEnabled(game, offIds, false);
      publish(game, change);
      changed = change.changed.map((m) => m.id);
    }
    held = await holdMods(game, refs, "update", false);
  } catch (e) { toast(errorText(e), true); return; }
  const what = rows.length === 1 ? rows[0]!.name : plural(rows.length, "mod");
  record({
    label: `${changed.length ? "Turned off" : "Muted"} ${what} until ${rows.length === 1 ? "its" : "their"} author posts an update`,
    undo: async () => { if (changed.length) await restoreStates(game, before, changed); await held?.undo(); },
    redo: async () => { if (offIds.length) publish(game, await library.setEnabled(game, offIds, false)); await held?.redo(); },
  });
}

/** Unmute one mod: its warnings show again. It stays off. */
export const unmute = (game: GameId, r: ModHealthRow) => releaseMods(game, [{ id: r.modId, name: r.name }]);

// after each check, with "Always turn off and mute mods that need their author" on: dead ends found go off and quiet
// by themselves
const running = new Set<GameId>();
onHealth((game, rows) => {
  if (running.has(game)) return;
  void (async () => {
    await Promise.all([autoMutePref.ready, holdsPref.ready, fixWarningsPref.ready]);
    if (!autoMutePref.get() || !fixWarningsPref.get()) return;
    const held = holdsNow(game);
    const fresh = rows.filter((r) => isDeadEnd(r) && !held[r.modId]);
    if (!fresh.length) return;
    running.add(game);
    try { await muteDeadEnds(game, fresh); } finally { running.delete(game); }
  })();
});
