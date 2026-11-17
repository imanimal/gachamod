// Mods whose problems the user set aside, from the Mods list, a mod's details or Tools. "ignore" hides every warning
// about the mod (a game update broke it, conflicts, no .ini, problems in its files) until the user takes it back;
// its conflicts are ignored on both sides, so the other mod stops showing Conflict too. "update" hides the game
// update warnings until the mod's files change through an update, so a new version that is still broken warns again.
// A held mod leaves the Problems filter, loses its red marks, moves to Ignored or Muted in Tools and stops counting on
// the Tools badge. Owner: FIXES area.
import { library, modtools, type GameId, type ModEntry } from "./api";
import { record } from "./history";
import { jsonPref } from "./prefs";
import { emitApp } from "./store";

export type HoldKind = "ignore" | "update";
export interface Hold {
  kind: HoldKind;
  /** When it was set (ms). */
  at: number;
  /** The mod's file, version and install time when it was set: "update" ends once these change. */
  mark?: string;
  /** Mods it conflicted with that the hold ignored the conflict with, put back when it ends. */
  pairs?: string[];
}
type GameHolds = Record<string, Hold>;

/** Holds per game, by mod id. */
export const holdsPref = jsonPref<Record<string, GameHolds>>("problems.held", {});
const NONE: GameHolds = {};

export function useHolds(game: GameId | null | undefined): GameHolds {
  const all = holdsPref.use();
  return (game && all[game]) || NONE;
}
export const holdsNow = (game: GameId): GameHolds => holdsPref.get()[game] ?? NONE;

/** What changes when a mod is updated. */
export const modMark = (m: Pick<ModEntry, "source" | "version" | "installedAt">) => `${m.source?.fileId ?? ""}|${m.version ?? ""}|${m.installedAt}`;

/** The hold on a mod that still stands: waiting for an update ends once the mod has been updated. */
export function holdOn(holds: GameHolds, m: ModEntry): Hold | null {
  const h = holds[m.id];
  if (!h) return null;
  return h.kind === "update" && h.mark && h.mark !== modMark(m) ? null : h;
}

type Change = Record<string, Hold | null>;

/** Save holds for some mods (null takes one away) and ignore or put back their conflicts. */
async function write(game: GameId, change: Change) {
  await holdsPref.ready;
  const all = holdsPref.get();
  const mine = { ...(all[game] ?? {}) };
  const pair: Array<[string, string]> = [];
  const unpair: Array<[string, string]> = [];
  for (const [id, h] of Object.entries(change)) {
    const old = mine[id];
    for (const o of old?.pairs ?? []) if (!h?.pairs?.includes(o)) unpair.push([id, o]);
    for (const o of h?.pairs ?? []) if (!old?.pairs?.includes(o)) pair.push([id, o]);
    if (h) mine[id] = h; else delete mine[id];
  }
  await holdsPref.set({ ...all, [game]: mine });
  for (const p of pair) await modtools.ignoreConflict(game, p, true).catch(() => {});
  for (const p of unpair) await modtools.ignoreConflict(game, p, false).catch(() => {});
  if (pair.length || unpair.length) emitApp({ type: "library-refresh", game });
}

const named = (list: Array<{ name: string }>) => (list.length === 1 ? list[0]!.name : `${list.length} mods`);

/** Set these mods' problems aside. `label` false records no Undo step (the caller records its own); the returned
 *  pair undoes and redoes it. */
export async function holdMods(game: GameId, mods: Array<{ id: string; name: string }>, kind: HoldKind, label: string | false = defaultLabel(mods, kind)) {
  if (!mods.length) return null;
  await holdsPref.ready;
  // the full rows: their version now (to see an update arrive) and whether they conflict
  const rows = await library.list(game).catch(() => [] as ModEntry[]);
  const byId = new Map(rows.map((m) => [m.id, m]));
  const now = Date.now();
  const change: Change = {};
  for (const ref of mods) {
    const m = byId.get(ref.id);
    let pairs: string[] | undefined;
    if (kind === "ignore" && m && m.conflicts > 0) {
      pairs = await modtools.inspect(game, m.id).then((d) => d.conflicts.map((c) => c.modId)).catch(() => undefined);
    }
    change[ref.id] = { kind, at: now, mark: m ? modMark(m) : undefined, ...(pairs?.length ? { pairs } : {}) };
  }
  const before: Change = Object.fromEntries(mods.map((m) => [m.id, holdsNow(game)[m.id] ?? null]));
  await write(game, change);
  const op = { undo: () => write(game, before), redo: () => write(game, change) };
  if (label) record({ label, ...op });
  return op;
}

function defaultLabel(mods: Array<{ name: string }>, kind: HoldKind) {
  return kind === "ignore" ? `Ignoring ${named(mods)}'s problems` : `Waiting for an update to ${named(mods)}`;
}

/** Show these mods' problems again. */
export async function releaseMods(game: GameId, mods: Array<{ id: string; name: string }>) {
  await holdsPref.ready;
  const held = mods.filter((m) => holdsNow(game)[m.id]);
  if (!held.length) return;
  const before: Change = Object.fromEntries(held.map((m) => [m.id, holdsNow(game)[m.id]!]));
  const change: Change = Object.fromEntries(held.map((m) => [m.id, null]));
  await write(game, change);
  record({ label: `Showing ${named(held)}'s problems again`, undo: () => write(game, before), redo: () => write(game, change) });
}

/** Keep the holds in step with the mod list: a wait without a version takes the one the mod has now, and a wait whose
 *  mod was updated ends, so the new version's warnings show if it is still broken. */
export async function settleHolds(game: GameId, mods: ModEntry[]) {
  if (!mods.length) return;
  await holdsPref.ready;
  const mine = holdsPref.get()[game];
  if (!mine) return;
  const byId = new Map(mods.map((m) => [m.id, m]));
  const change: Change = {};
  for (const [id, h] of Object.entries(mine)) {
    const m = byId.get(id);
    if (!m || h.kind !== "update") continue;
    if (!h.mark) change[id] = { ...h, mark: modMark(m) };
    else if (h.mark !== modMark(m)) change[id] = null;
  }
  if (Object.keys(change).length) await write(game, change);
}
