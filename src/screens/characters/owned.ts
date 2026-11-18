// The characters the player owns, per game: kept for the session, changed with Undo, imported from optimizer and
// scanner exports, a pasted list, gachamod's own file or the player's public profile (by UID), and saved as gachamod's
// own file. Also the "other managers" import for the Mods folder. Owner: LIBRARY area.
import { useEffect, useSyncExternalStore } from "react";
import { dialogs, errorText, otherManagers, owned as ownedApi, settings, type ForeignInfo, type GameId, type OwnedImport } from "../../lib/api";
import { charCount, charNoun } from "../../lib/games";
import { t, tn } from "../../lib/i18n";
import { record } from "../../lib/history";
import { inTauri } from "../../lib/tauri";
import { toast } from "../../ui/toast";
import { notesText } from "../../lib/notes";

// lowercased name -> name, per game
const cache = new Map<GameId, Map<string, string>>();
const subs = new Set<() => void>();
let version = 0;
const emit = () => { version++; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

const pending = new Map<GameId, Promise<void>>();
function load(game: GameId, force = false): Promise<void> {
  if (!force && cache.has(game)) return Promise.resolve();
  const p = pending.get(game) ?? ownedApi.list(game)
    .then((l) => { cache.set(game, new Map(l.map((n) => [n.toLowerCase(), n]))); emit(); })
    .catch(() => {})
    .finally(() => pending.delete(game));
  pending.set(game, p);
  return p;
}

/** The owned characters of a game (lowercased name to name), or null while loading. */
export function useOwned(game: GameId): Map<string, string> | null {
  useSyncExternalStore(subscribe, () => version);
  useEffect(() => { void load(game); }, [game]);
  return cache.get(game) ?? null;
}

/** Owned or not, as far as loaded (it starts loading the game's list when it isn't). */
export function isOwned(game: GameId, name: string): boolean {
  if (!cache.has(game)) void load(game);
  return cache.get(game)?.has(name.trim().toLowerCase()) ?? false;
}

function apply(game: GameId, names: string[], on: boolean) {
  const m = new Map(cache.get(game) ?? []);
  for (const n of names) { if (on) m.set(n.toLowerCase(), n); else m.delete(n.toLowerCase()); }
  cache.set(game, m);
  emit();
}

async function change(game: GameId, names: string[], on: boolean): Promise<string[]> {
  const changed = await ownedApi.set(game, names, on);
  apply(game, changed, on);
  return changed;
}

const count = (game: GameId, n: number) => charCount(game, n);

/** Mark characters as owned or not, with Undo. The Owned button, menu check or tile mark shows it, so no toast. */
export async function setOwned(game: GameId, names: string[], on: boolean) {
  try {
    const changed = await change(game, names, on);
    if (!changed.length) return;
    const what = changed.length === 1 ? changed[0]! : count(game, changed.length);
    record({ label: on ? t("Marked {what} as owned", { what }) : t("Marked {what} as not owned", { what }), undo: () => change(game, changed, !on), redo: () => change(game, changed, on) }, true);
  } catch (e) { toast(errorText(e), true); }
}

export async function toggleOwned(game: GameId, name: string) {
  await load(game);
  await setOwned(game, [name], !isOwned(game, name));
}

// ── importing ──

/** Names the last import couldn't match, per game, for the "3 not recognised" link. */
const unknown = new Map<GameId, { names: string[]; format: string }>();
export function useUnrecognised(game: GameId) {
  useSyncExternalStore(subscribe, () => version);
  return unknown.get(game) ?? null;
}
export function forgetUnrecognised(game: GameId) { if (unknown.delete(game)) emit(); }

/** The games whose public profiles Enka.Network reads by UID. */
export const byUid = (game: GameId) => game === "gi" || game === "hsr" || game === "zzz";
const uidKey = (game: GameId) => `${game}.uid`;
/** The UID last read for a game, to fill the field next time. */
export const savedUid = (game: GameId) => settings.get(uidKey(game)).then((v) => v ?? "").catch(() => "");

export type OwnedSource = { text: string } | { path: string } | { uid: string };

/** Read an export file, its text, a pasted list or the player's profile and mark everything in it as owned, with Undo. */
export async function importOwned(game: GameId, from: OwnedSource): Promise<OwnedImport | null> {
  let r: OwnedImport;
  try {
    if ("uid" in from) {
      r = await ownedApi.fetch(game, from.uid);
      void settings.set(uidKey(game), from.uid.trim()).catch(() => {});
    } else r = "path" in from ? await ownedApi.importFile(game, from.path) : await ownedApi.import(game, from.text);
  } catch (e) {
    toast(errorText(e), true);
    return null;
  }
  apply(r.game, r.added, true);
  if (r.unknown.length) unknown.set(r.game, { names: r.unknown, format: r.format }); else unknown.delete(r.game);
  emit();
  // "in another game" when the export was for another game, and how many names matched nothing
  const more = (text: string) => {
    const there = r.game !== game ? t("{text} in another game", { text }) : text;
    return r.unknown.length ? t("{text}, {n} not recognised", { text: there, n: r.unknown.length }) : there;
  };
  if (!r.added.length) {
    toast(more(r.already === 1 ? t("That one was already marked as owned") : t("All {n} were already marked as owned", { n: r.already })));
    return r;
  }
  record({
    label: more(t("Marked {what} as owned", { what: count(r.game, r.added.length) })),
    undo: () => change(r.game, r.added, false),
    redo: () => change(r.game, r.added, true),
  });
  return r;
}

/** Save the owned list as gachamod's own JSON, which Import reads back (on another PC, after a reinstall). */
export async function saveOwned(game: GameId) {
  const file = `${game}-owned.json`;
  try {
    if (!inTauri()) {
      // the browser demo: a download
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([await ownedApi.export(game)], { type: "application/json" }));
      a.download = file;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      return;
    }
    const path = await dialogs.saveFile({ title: t("Save the {noun} you own", { noun: charNoun(game).toLowerCase() }), defaultPath: file, extensions: ["json"] });
    if (!path) return;
    const n = await ownedApi.exportFile(game, path);
    toast(t("Saved {what} to the file", { what: count(game, n) }));
  } catch (e) { toast(errorText(e), true); }
}

/** A file that could be a character export (checked again when read). */
export const looksLikeExport = (path: string) => /\.(json|txt|csv)$/i.test(path);

// ── other managers' details in the Mods folder ──

const foreign = new Map<GameId, ForeignInfo>();
const checked = new Set<GameId>();

/** What other managers left in the game's Mods folder, checked once a session (it only reads). */
export function useForeign(game: GameId, enabled: boolean): ForeignInfo | null {
  useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    if (!enabled || checked.has(game)) return;
    checked.add(game);
    otherManagers.detect(game).then((f) => { foreign.set(game, f); emit(); }).catch(() => {});
  }, [game, enabled]);
  return foreign.get(game) ?? null;
}

export function dismissForeign(game: GameId) { foreign.set(game, { managers: [], fillable: 0 }); emit(); }

/** Bring in names, characters, links and pictures other managers saved, with Undo. */
export async function importForeign(game: GameId, onDone?: () => void) {
  try {
    const r = await otherManagers.import(game);
    foreign.set(game, { managers: [], fillable: 0 });
    emit();
    onDone?.();
    if (r.notes.length) toast(notesText(r.notes), true);
    if (!r.changed) { toast(t("Nothing new to bring in")); return; }
    const mods = tn(r.changed, "{n} mod", "{n} mods");
    const who = r.managers.length > 1 ? t("{names} and {last}", { names: r.managers.slice(0, -1).join(", "), last: r.managers[r.managers.length - 1]! }) : r.managers[0];
    record({
      label: who ? t("Brought in details for {mods} from {who}", { mods, who }) : t("Brought in details for {mods}", { mods }),
      brief: t("Brought in details for {mods}", { mods }),
      undo: async () => { await otherManagers.undo(game, r.undo); onDone?.(); },
      redo: async () => { await otherManagers.import(game); onDone?.(); },
    });
  } catch (e) { toast(errorText(e), true); }
}

/** Reload after another screen changed things (a rescan). */
export function reloadOwned(game: GameId) { void load(game, true); }
