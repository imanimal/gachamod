// The library's data for the screens that show mods (Mods, Characters): the list at once, a scan when the last one
// is older than 30 seconds, re-lists on backend and app events, and changes from actions applied in place.
// Owner: LIBRARY area.
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, library, type GameId, type ModChange, type ModEntry } from "../../lib/api";
import { held } from "../../lib/tauri";
import { checkUpdates, queueLatest } from "../../lib/gamebanana";
import { go, onApp, setBadge } from "../../lib/store";
import { record, undo } from "../../lib/history";
import { toast } from "../../ui/toast";
import { plural } from "../../ui/kit";
import { notesText } from "../../lib/notes";
import { autoRescanPref } from "../settings/automatic";
import { sayF10 } from "../../lib/elevation";

const count = (n: number) => (n === 1 ? "1 mod" : `${n} mods`);

const SCAN_AGE = 30_000;
const lastScan = new Map<GameId, number>();
let purged = false;

// ── changes made anywhere (actions, undo, profile switches) reach every screen showing that game's mods ──

type Listener = (game: GameId, change: ModChange) => void;
const listeners = new Set<Listener>();
export function publish(game: GameId, change: ModChange) { listeners.forEach((f) => f(game, change)); }
/** Hear every published change (live switching keeps its picks in step with the library). */
export function onPublish(f: Listener) { listeners.add(f); return () => { listeners.delete(f); }; }

/** A list with a change applied: changed entries replaced (or added), removed ones dropped. */
export function applyChange(list: ModEntry[], change: ModChange): ModEntry[] {
  const gone = new Set(change.removed);
  const byId = new Map(change.changed.map((m) => [m.id, m]));
  const known = new Set(list.map((m) => m.id));
  const out = list.filter((m) => !gone.has(m.id)).map((m) => byId.get(m.id) ?? m);
  return [...change.changed.filter((m) => !known.has(m.id) && !gone.has(m.id)), ...out];
}

export function useMods(game: GameId) {
  const [mods, setMods] = useState<ModEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [scanning, setScanning] = useState(false);
  const alive = useRef(true);

  const relist = useCallback(async () => {
    try {
      const l = await library.list(game);
      if (alive.current) { setMods(l); setLoaded(true); }
    } catch (e) { if (alive.current) { setLoaded(true); toast(errorText(e), true); } }
  }, [game]);

  const rescan = useCallback(async (quiet = false) => {
    setScanning(true);
    try {
      const l = await library.scan(game);
      lastScan.set(game, Date.now());
      if (alive.current) { setMods(l); setLoaded(true); }
      if (quiet) return;
      // asked for by hand: also look for updates now, whatever the automatic check is set to
      const linked = l.filter((m) => m.source);
      if (!linked.length) { toast(`Found ${count(l.length)}`); return; }
      toast(`Found ${count(l.length)}. Checking ${linked.length === l.length ? "them" : count(linked.length)} for updates on GameBanana`);
      try {
        const ids = await checkUpdates(l);
        await library.markUpdates(game, ids);
        const want = new Set(ids);
        if (alive.current) setMods((now) => now.map((m) => (m.updateAvailable === want.has(m.id) ? m : { ...m, updateAvailable: want.has(m.id) })));
        setBadge("library", ids.length ? { count: ids.length, tone: "accent" } : null);
        toast(ids.length ? `${ids.length === 1 ? "1 mod has" : `${ids.length} mods have`} an update` : "Every mod is up to date");
      } catch (e) { toast(`Couldn't check for updates: ${errorText(e)}`, true); }
    } catch (e) {
      if (alive.current) setLoaded(true);
      toast(errorText(e), true);
    } finally { if (alive.current) setScanning(false); }
  }, [game]);

  useEffect(() => {
    alive.current = true;
    let live = true;
    library.list(game).then((l) => {
      if (!live) return;
      setMods(l);
      if (l.length) setLoaded(true);
      if (Date.now() - (lastScan.get(game) ?? 0) > SCAN_AGE) void autoRescanPref.ready.then(() => { if (!live) return; if (autoRescanPref.get() || !l.length) void rescan(true); else setLoaded(true); });
      else setLoaded(true);
    }).catch((e) => { if (live) { setLoaded(true); toast(errorText(e), true); } });
    if (!purged) { purged = true; library.trashPurge(null).catch(() => {}); }
    const onChange: Listener = (g, change) => { if (g === game && live) setMods((l) => applyChange(l, change)); };
    listeners.add(onChange);
    const offBackend = held(library.onChanged((p) => { if (p.game === game && live) void relist(); }));
    const offApp = onApp((e) => { if (e.type === "library-refresh" && e.game === game && live) void relist(); });
    return () => { live = false; alive.current = false; listeners.delete(onChange); offBackend(); offApp(); };
  }, [game, relist, rescan]);

  return { mods, setMods, loaded, scanning, rescan, relist };
}

// ── actions with Undo ──

const nameOf = (list: ModEntry[], what: string) => (list.length === 1 ? list[0]!.name : `${list.length} ${what}`);

/** "Turned on 2, turned off Coca Cola" style summary of a change. */
export function summarize(change: ModChange): string {
  const on = change.changed.filter((m) => m.enabled), off = change.changed.filter((m) => !m.enabled);
  const parts: string[] = [];
  if (on.length) parts.push(`turned on ${nameOf(on, "mods")}`);
  if (off.length) parts.push(`turned off ${nameOf(off, "mods")}`);
  const s = parts.join(", ");
  return s ? s[0]!.toUpperCase() + s.slice(1) : "Nothing changed";
}

/** Put mods back to earlier on/off states (undo). Offs first so the one-skin rule never undoes the ons. */
export async function restoreStates(game: GameId, prior: Map<string, boolean>, ids: string[]) {
  const offs = ids.filter((id) => prior.get(id) === false);
  const ons = ids.filter((id) => prior.get(id) === true);
  if (offs.length) publish(game, await library.setEnabled(game, offs, false));
  if (ons.length) publish(game, await library.setEnabled(game, ons, true));
}

/** Turn mods on or off, show one toast with the notes and an Undo. `prior` is every mod's state before.
 *  `turnOffOthers`: the user's answer about the character's other mods (overlap.ts). Throws on failure (the caller
 *  shows it and undoes its optimistic change). */
export async function toggleMods(game: GameId, ids: string[], on: boolean, prior: ModEntry[], turnOffOthers?: boolean): Promise<ModChange> {
  const change = await library.setEnabled(game, ids, on, turnOffOthers);
  publish(game, change);
  const before = new Map(prior.map((m) => [m.id, m.enabled]));
  const changedIds = change.changed.map((m) => m.id);
  if (!changedIds.length) {
    const rest = sayF10(change.notes);
    if (rest.length) toast(notesText(rest));
    return change;
  }
  const mine = change.changed.filter((m) => ids.includes(m.id));
  const main = mine.length ? `Turned ${on ? "on" : "off"} ${nameOf(mine, "mods")}` : summarize(change);
  record({
    label: notesText([main, ...sayF10(change.notes)]),
    undo: () => restoreStates(game, before, changedIds),
    redo: async () => { publish(game, await library.setEnabled(game, ids, on, turnOffOthers)); },
  });
  return change;
}

/** Turn some mods off and others on as one action with one Undo ("Wear", "Default outfit"). */
export async function changeStates(game: GameId, label: string, ons: string[], offs: string[], prior: ModEntry[]): Promise<ModChange> {
  const merged: ModChange = { changed: [], removed: [], notes: [] };
  const add = (c: ModChange) => {
    for (const m of c.changed) { const i = merged.changed.findIndex((x) => x.id === m.id); if (i >= 0) merged.changed[i] = m; else merged.changed.push(m); }
    merged.notes.push(...c.notes);
  };
  if (offs.length) add(await library.setEnabled(game, offs, false));
  if (ons.length) add(await library.setEnabled(game, ons, true));
  publish(game, merged);
  const before = new Map(prior.map((m) => [m.id, m.enabled]));
  const changedIds = merged.changed.map((m) => m.id);
  if (!changedIds.length) {
    const rest = sayF10(merged.notes);
    if (rest.length || !merged.notes.length) toast(rest.length ? notesText(rest) : "Nothing to change");
    return merged;
  }
  record({
    label: notesText([label, ...sayF10(merged.notes)]),
    undo: () => restoreStates(game, before, changedIds),
    redo: async () => {
      if (offs.length) publish(game, await library.setEnabled(game, offs, false));
      if (ons.length) publish(game, await library.setEnabled(game, ons, true));
    },
  });
  return merged;
}

/** Send mods to the trash with Undo (restores them from the trash). */
export async function removeMods(game: GameId, list: ModEntry[]): Promise<ModChange> {
  const ids = list.map((m) => m.id);
  const change = await library.remove(game, ids);
  publish(game, change);
  if (change.notes.length) toast(notesText(change.notes), true);
  if (!change.removed.length) return change;
  const removedNames = list.filter((m) => change.removed.includes(m.id));
  let gone = change.removed;
  const many = removedNames.length >= 50;
  const entry = record({
    label: `Removed ${nameOf(removedNames, "mods")}`,
    undo: async () => {
      const trash = await library.trash(game);
      const back: string[] = [];
      const fetch: number[] = [];
      for (const id of gone) {
        const t = trash.find((x) => x.modId === id);
        if (t) {
          const ch = await library.trashRestore(t.id);
          publish(game, ch);
          back.push(...ch.changed.map((m) => m.id));
          continue;
        }
        // its files were deleted (Keep removed mods' files is off): download it again, its settings come back
        const src = list.find((m) => m.id === id)?.source;
        if (src) fetch.push(src.modId);
      }
      for (const gb of fetch) await queueLatest(game, gb);
      if (fetch.length) toast(`Downloading ${plural(fetch.length, "mod")} again. Settings come back when they install`, false, { label: "Downloads", run: () => go("downloads") });
      gone = back;
    },
    redo: async () => {
      const ch = await library.remove(game, gone);
      publish(game, ch);
      gone = ch.removed;
    },
  }, many);
  if (many) toast(`Removed ${removedNames.length} mods. Fresh start?`, false, { label: "Undo", run: () => void undo(entry) });
  return change;
}
