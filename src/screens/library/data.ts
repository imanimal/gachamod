// The library's data for the screens that show mods (Mods, Characters): the list at once, a scan when the last one
// is older than 30 seconds (only the first one each session while Mods folders are watched: the backend rescans a
// folder when it changes and sends library-changed), re-lists on backend and app events, and changes from actions
// applied in place.
// Owner: LIBRARY area.
import { useCallback, useEffect, useRef, useState } from "react";
import { errorKind, errorText, library, type GameId, type ModChange, type ModEntry } from "../../lib/api";
import { held } from "../../lib/tauri";
import { checkUpdates, queueLatest } from "../../lib/gamebanana";
import { go, onApp, recountMods } from "../../lib/store";
import { record, undo } from "../../lib/history";
import { toast } from "../../ui/toast";
import { t, tn } from "../../lib/i18n";
import { notesText } from "../../lib/notes";
import { autoRescanPref, trashDaysPref, watchModsPref } from "../settings/automatic";
import { confirmDelete } from "./confirmDelete";
import { sayF10 } from "../../lib/elevation";

const count = (n: number) => tn(n, "{n} mod", "{n} mods");

const SCAN_AGE = 30_000;
const lastScan = new Map<GameId, number>();
let purged = false;

// ── changes made anywhere (actions, undo, profile switches) reach every screen showing that game's mods ──

type Listener = (game: GameId, change: ModChange) => void;
const listeners = new Set<Listener>();
export function publish(game: GameId, change: ModChange) { listeners.forEach((f) => f(game, change)); recountMods(game); }
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

/** A fresh list with the entries that didn't change kept as the same objects, so their cards don't render again. */
export function reuse(prev: ModEntry[], next: ModEntry[]): ModEntry[] {
  if (!prev.length) return next;
  const old = new Map(prev.map((m) => [m.id, m]));
  let same = prev.length === next.length;
  const out = next.map((m, i) => {
    const o = old.get(m.id);
    const keep = o && JSON.stringify(o) === JSON.stringify(m) ? o : m;
    if (keep !== prev[i]) same = false;
    return keep;
  });
  return same ? prev : out;
}

/** Why the list couldn't be read. `kind` is the backend's: "not_set_up" when the game's Mods folder is missing. */
export interface ModsError { kind: string; text: string }

/** The last list of each game, so coming back to a screen shows it at once while the folder is read again. */
const lastList = new Map<GameId, ModEntry[]>();

/** `showsErrors`: the screen draws `error` itself, so a failure is toasted only while a list stays on screen. */
export function useMods(game: GameId, { showsErrors = false }: { showsErrors?: boolean } = {}) {
  const [mods, setMods] = useState<ModEntry[]>(() => lastList.get(game) ?? []);
  const [loaded, setLoaded] = useState(() => lastList.has(game));
  const [error, setError] = useState<ModsError | null>(null);
  const [scanning, setScanning] = useState(false);
  // another game: start from its last list (or nothing) in this same render, so the old game's cards never show
  const [owner, setOwner] = useState(game);
  if (owner !== game) {
    setOwner(game);
    setMods(lastList.get(game) ?? []);
    setLoaded(lastList.has(game));
    setError(null);
    setScanning(false);
  }
  const alive = useRef(true);
  // the game on screen now: an answer for another game (a scan still running across a switch) is dropped
  const gameRef = useRef(game);
  gameRef.current = game;
  const listRef = useRef(mods);
  listRef.current = mods;

  useEffect(() => { if (owner === game && loaded && !error) lastList.set(game, mods); }, [owner, game, mods, loaded, error]);

  const fail = useCallback((e: unknown) => {
    const err = { kind: errorKind(e), text: errorText(e) };
    setError(err);
    setLoaded(true);
    // a missing Mods folder is drawn by the screen in place of the list, even when an old list was showing
    if (!showsErrors || (err.kind !== "not_set_up" && listRef.current.length > 0)) toast(err.text, true);
  }, [showsErrors]);

  const relist = useCallback(async () => {
    try {
      const l = await library.list(game);
      // list only reads the database, so it can't tell the Mods folder is back: only a scan clears that error
      if (alive.current && gameRef.current === game) { setMods((was) => reuse(was, l)); setLoaded(true); setError((e) => (e?.kind === "not_set_up" ? e : null)); }
    } catch (e) { if (alive.current && gameRef.current === game) fail(e); }
  }, [game, fail]);

  const rescan = useCallback(async (quiet = false) => {
    setScanning(true);
    try {
      const l = await library.scan(game);
      lastScan.set(game, Date.now());
      const mine = () => alive.current && gameRef.current === game;
      if (mine()) { setMods((was) => reuse(was, l)); setLoaded(true); setError(null); }
      if (quiet) return;
      // asked for by hand: also look for updates now, whatever the automatic check is set to
      const linked = l.filter((m) => m.source);
      if (!linked.length) { toast(tn(l.length, "Found {n} mod", "Found {n} mods")); return; }
      toast(linked.length === l.length
        ? tn(l.length, "Found {n} mod. Checking it for updates on GameBanana", "Found {n} mods. Checking them for updates on GameBanana")
        : t("Found {found}. Checking {linked} for updates on GameBanana", { found: count(l.length), linked: count(linked.length) }));
      try {
        const ids = await checkUpdates(l);
        await library.markUpdates(game, ids);
        const want = new Set(ids);
        if (mine()) setMods((now) => now.map((m) => (m.updateAvailable === want.has(m.id) ? m : { ...m, updateAvailable: want.has(m.id) })));
        recountMods(game);
        toast(ids.length ? tn(ids.length, "{n} mod has an update", "{n} mods have an update") : t("Every mod is up to date"));
      } catch (e) { toast(t("Couldn't check for updates: {error}", { error: errorText(e) }), true); }
    } catch (e) {
      if (alive.current && gameRef.current === game) fail(e);
      else toast(errorText(e), true);
    } finally { if (alive.current && gameRef.current === game) setScanning(false); }
  }, [game, fail]);

  useEffect(() => {
    alive.current = true;
    let live = true;
    library.list(game).then((l) => {
      if (!live) return;
      setMods((was) => reuse(was, l));
      setError(null);
      // an empty list waits for the scan below, so a first visit doesn't flash "No mods yet"
      setLoaded(l.length > 0);
      // a watched Mods folder is scanned by the backend when it changes: only the session's first visit scans here
      const stale = Date.now() - (lastScan.get(game) ?? 0) > SCAN_AGE;
      if (stale) void Promise.all([autoRescanPref.ready, watchModsPref.ready]).then(() => {
        if (!live) return;
        if (watchModsPref.get() && lastScan.has(game) && l.length) setLoaded(true);
        else if (autoRescanPref.get() || !l.length) void rescan(true);
        else setLoaded(true);
      });
      else setLoaded(true);
    }).catch((e) => { if (live) fail(e); });
    if (!purged) { purged = true; library.trashPurge(null).catch(() => {}); }
    const onChange: Listener = (g, change) => {
      if (g !== game || !live) return;
      const was = new Map(listRef.current.map((m) => [m.id, m.enabled]));
      setMods((l) => applyChange(l, change));
      // a mod turned on, off or removed changes the Conflict tag on the mods it shares parts with
      if (change.removed.length || change.changed.some((m) => was.get(m.id) !== m.enabled)) void relist();
    };
    listeners.add(onChange);
    const offBackend = held(library.onChanged((p) => { if (p.game === game && live) void relist(); }));
    const offApp = onApp((e) => { if (e.type === "library-refresh" && e.game === game && live) void relist(); });
    return () => { live = false; alive.current = false; listeners.delete(onChange); offBackend(); offApp(); };
  }, [game, relist, rescan, fail]);

  return { mods, setMods, loaded, error, scanning, rescan, relist };
}

// ── actions with Undo ──

const nameOf = (list: ModEntry[]) => (list.length === 1 ? list[0]!.name : count(list.length));

/** "Turned on 2, turned off Coca Cola" style summary of a change. */
export function summarize(change: ModChange): string {
  const on = change.changed.filter((m) => m.enabled), off = change.changed.filter((m) => !m.enabled);
  if (on.length && off.length) return t("Turned on {on}, turned off {off}", { on: nameOf(on), off: nameOf(off) });
  if (on.length) return t("Turned on {mods}", { mods: nameOf(on) });
  if (off.length) return t("Turned off {mods}", { mods: nameOf(off) });
  return t("Nothing changed");
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
  // names everything that changed, so a skin the one-skin rule turned off shows up too ("Turned on X, turned off Y")
  const main = summarize(change);
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
    if (rest.length || !merged.notes.length) toast(rest.length ? notesText(rest) : t("Nothing to change"));
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

/** Send mods to the trash with Undo (restores them from the trash, or downloads them again). When the trash keeps no
 *  files, mods with no GameBanana link can't come back, so that is asked first. */
export async function removeMods(game: GameId, list: ModEntry[]): Promise<ModChange> {
  const lost = trashDaysPref.get() > 0 ? [] : list.filter((m) => !m.source);
  if (lost.length && !(await confirmDelete(lost, list.length))) return { changed: [], removed: [], notes: [] };
  const ids = list.map((m) => m.id);
  const change = await library.remove(game, ids);
  publish(game, change);
  if (change.notes.length) toast(notesText(change.notes), true);
  if (!change.removed.length) return change;
  const removedNames = list.filter((m) => change.removed.includes(m.id));
  let gone = change.removed;
  const many = removedNames.length >= 50;
  const entry = record({
    label: t("Removed {mods}", { mods: nameOf(removedNames) }),
    undo: async () => {
      const trash = await library.trash(game);
      const back: string[] = [];
      const fetch: number[] = [];
      const stuck: string[] = [];
      for (const id of gone) {
        const tr = trash.find((x) => x.modId === id);
        if (tr) {
          const ch = await library.trashRestore(tr.id);
          publish(game, ch);
          back.push(...ch.changed.map((m) => m.id));
          continue;
        }
        // its files were deleted (Keep removed mods' files is off): download it again, its settings come back
        const m = list.find((x) => x.id === id);
        if (m?.source) fetch.push(m.source.modId);
        else stuck.push(m?.name ?? id);
      }
      for (const gb of fetch) await queueLatest(game, gb);
      if (fetch.length) toast(tn(fetch.length, "Downloading {n} mod again. Settings come back when they install", "Downloading {n} mods again. Settings come back when they install"), false, { label: t("Downloads"), run: () => go("downloads") });
      if (stuck.length) {
        const first = stuck.slice(0, 3).join(", ");
        const names = stuck.length > 3 ? t("{names} and {n} more", { names: first, n: stuck.length - 3 }) : first;
        toast(stuck.length === 1
          ? t("Couldn't bring back {names}. The files were deleted and there's no GameBanana link", { names })
          : t("Couldn't bring back {names}. Their files were deleted and they have no GameBanana link", { names }), true);
      }
      gone = back;
    },
    redo: async () => {
      const ch = await library.remove(game, gone);
      publish(game, ch);
      gone = ch.removed;
    },
  }, many);
  if (many) toast(t("Removed {n} mods. Fresh start?", { n: removedNames.length }), false, { label: t("Undo"), run: () => void undo(entry) });
  return change;
}
