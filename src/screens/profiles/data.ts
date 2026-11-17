// Profiles for the screens that show them (Profiles, Home, the sidebar): the list, a bus so they stay in step, the
// last list per game (for menus and search, which are built at once), the game's character portraits for
// "char:<Name>" icons, and switching with Undo. Owner: HOME/PROFILES area.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { characters, errorText, library, profiles, type Character, type GameId, type Profile } from "../../lib/api";
import { record } from "../../lib/history";
import { held } from "../../lib/tauri";
import { toast } from "../../ui/toast";
import { publish, summarize } from "../library/data";
import { sayF10 } from "../../lib/elevation";

const subs = new Set<(game: GameId) => void>();
const lastLists = new Map<GameId, Profile[]>();
/** Tell every profile list for this game to reload. */
export function profilesChanged(game: GameId) { lastLists.delete(game); subs.forEach((f) => f(game)); }

/** The list loaded last for a game (null before any), and a fresh one on the way. */
export function knownProfiles(game: GameId): Profile[] | null {
  const l = lastLists.get(game);
  if (!l) void loadProfiles(game).catch(() => {});
  return l ?? null;
}
export async function loadProfiles(game: GameId): Promise<Profile[]> {
  const l = await profiles.list(game);
  lastLists.set(game, l);
  return l;
}

export function useProfiles(game: GameId | undefined) {
  const [list, setList] = useState<Profile[] | null>(null);
  // why the last load failed, so the Profiles page can say so instead of "No profiles yet"
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!game) { setList(null); setError(null); return; }
    let live = true;
    loadProfiles(game).then((l) => { if (live) { setList(l); setError(null); } }).catch((e) => {
      if (!live) return;
      const msg = errorText(e);
      setList((x) => x ?? []);
      setError(msg);
      toast(msg, true);
    });
    return () => { live = false; };
  }, [game, tick]);
  useEffect(() => {
    const f = (g: GameId) => { if (g === game) reload(); };
    subs.add(f);
    // the backend's library-changed covers switches made by an in-game hotkey
    const off = held(library.onChanged((p) => f(p.game)));
    return () => { subs.delete(f); off(); };
  }, [game, reload]);
  // a new game's list replaces the old one only when it arrives
  useEffect(() => { setList(null); setError(null); }, [game]);
  return { list, reload, error };
}

// character portraits per game, loaded once per session
const portraits = new Map<GameId, Promise<Character[]>>();
export function useCharacters(game: GameId | undefined): Character[] {
  const [chars, setChars] = useState<Character[]>([]);
  useEffect(() => {
    if (!game) return;
    let live = true;
    let p = portraits.get(game);
    if (!p) { p = characters.list(game).catch(() => []); portraits.set(game, p); }
    void p.then((c) => {
      if (!live) return;
      setChars(c);
      // nothing with icons yet (the Characters screen fills them): ask again next time
      if (!c.some((x) => x.icon)) portraits.delete(game);
    });
    return () => { live = false; };
  }, [game]);
  return chars;
}

// the switch under way, shared so the card, Home, the sidebar and the menu all show it and a second can't start
export type Switching = { game: GameId; id: number; name: string };
let switching: Switching | null = null;
const switchSubs = new Set<() => void>();
const setSwitching = (s: Switching | null) => { switching = s; switchSubs.forEach((f) => f()); };
/** The profile being switched to right now, if any. */
export const switchingNow = () => switching;
export const useSwitching = () => useSyncExternalStore((f) => { switchSubs.add(f); return () => { switchSubs.delete(f); }; }, () => switching);

/** Switch to a profile, show what changed, and offer Undo (switch back). Does nothing while another switch runs. */
export async function switchProfile(game: GameId, to: Profile, from: Profile | null): Promise<void> {
  if (switching) return;
  setSwitching({ game, id: to.id, name: to.name });
  try { await switchNow(game, to, from); } finally { setSwitching(null); }
}

async function switchNow(game: GameId, to: Profile, from: Profile | null): Promise<void> {
  const go = async (p: Profile) => {
    const r = await profiles.activate(p.id);
    publish(game, r.change);
    profilesChanged(game);
    return r;
  };
  const r = await go(to);
  const parts = [`Switched to ${to.name}`, r.change.changed.length ? summarize(r.change) : "No mods needed changing"];
  if (r.varsPending) parts.push("Mod options apply after you close the game");
  parts.push(...sayF10(r.change.notes));
  if (from && from.id !== to.id) {
    record({ label: parts.join(". "), undo: () => go(from), redo: () => go(to) });
  } else {
    toast(`${parts.join(". ")}.`);
  }
}
