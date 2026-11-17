// Broken mods no fix here will help (lib/fixes isDeadEnd): turn them off and stop listing them, all at once, by hand
// from Tools > Fixes or by itself after each check when "fixes.autoMute" is on. Owner: FIXES area.
import { errorText, library, type GameId, type ModHealthRow } from "../../lib/api";
import { autoMutePref, fixWarningsPref, isDeadEnd, isMuted, muteKey, mutedPref, onHealth } from "../../lib/fixes";
import { record } from "../../lib/history";
import { plural } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { publish, restoreStates } from "../library/data";

/** Turn these mods off and mute their warnings, as one Undo step. */
export async function muteDeadEnds(game: GameId, rows: ModHealthRow[]) {
  if (!rows.length) return;
  const keys = rows.map((r) => muteKey(r.modId, r));
  const offIds = rows.filter((r) => r.enabled).map((r) => r.modId);
  const before = new Map(rows.map((r) => [r.modId, r.enabled]));
  const setMuted = (on: boolean) => {
    const all = { ...mutedPref.get() };
    const now = new Set(all[game] ?? []);
    for (const k of keys) { if (on) now.add(k); else now.delete(k); }
    all[game] = [...now];
    return mutedPref.set(all);
  };
  let changed: string[] = [];
  try {
    if (offIds.length) {
      const change = await library.setEnabled(game, offIds, false);
      publish(game, change);
      changed = change.changed.map((m) => m.id);
    }
    await setMuted(true);
  } catch (e) { toast(errorText(e), true); return; }
  const what = rows.length === 1 ? rows[0]!.name : plural(rows.length, "mod");
  record({
    label: `${changed.length ? "Turned off and muted" : "Muted"} ${what} that need${rows.length === 1 ? "s" : ""} an update from ${rows.length === 1 ? "its" : "their"} author`,
    undo: async () => { if (changed.length) await restoreStates(game, before, changed); await setMuted(false); },
    redo: async () => { if (offIds.length) publish(game, await library.setEnabled(game, offIds, false)); await setMuted(true); },
  });
}

/** Unmute one mod: its warnings show again. It stays off. */
export function unmute(game: GameId, r: ModHealthRow) {
  const all = { ...mutedPref.get() };
  all[game] = (all[game] ?? []).filter((k) => k !== muteKey(r.modId, r));
  void mutedPref.set(all, `Showing ${r.name}'s warnings again`);
}

// after each check, with "Always turn off and mute mods that need their author" on: dead ends found go off and quiet
// by themselves
const running = new Set<GameId>();
onHealth((game, rows) => {
  if (running.has(game)) return;
  void (async () => {
    await Promise.all([autoMutePref.ready, mutedPref.ready, fixWarningsPref.ready]);
    if (!autoMutePref.get() || !fixWarningsPref.get()) return;
    const muted = mutedPref.get();
    const fresh = rows.filter((r) => isDeadEnd(r) && !isMuted(muted, game, r.modId, r));
    if (!fresh.length) return;
    running.add(game);
    try { await muteDeadEnds(game, fresh); } finally { running.delete(game); }
  })();
});
