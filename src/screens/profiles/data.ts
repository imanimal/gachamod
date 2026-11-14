// Profiles for the screens that show them (Profiles, Home, the sidebar): the list, a bus so they stay in step, the
// last list per game (for menus and search, which are built at once), the game's character portraits for
// "char:<Name>" icons, and switching with Undo. Owner: HOME/PROFILES area.
import { useCallback, useEffect, useState } from "react";
import { characters, errorText, library, profiles, type Character, type GameId, type Profile } from "../../lib/api";
import { record } from "../../lib/history";
import { held } from "../../lib/tauri";
import { toast } from "../../ui/toast";
import { publish, summarize } from "../library/data";

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
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!game) { setList(null); return; }
    let live = true;
    loadProfiles(game).then((l) => { if (live) setList(l); }).catch((e) => { if (live) { setList((x) => x ?? []); toast(errorText(e), true); } });
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
  useEffect(() => { setList(null); }, [game]);
  return { list, reload };
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

/** Switch to a profile, show what changed, and offer Undo (switch back). */
export async function switchProfile(game: GameId, to: Profile, from: Profile | null): Promise<void> {
  const go = async (p: Profile) => {
    const r = await profiles.activate(p.id);
    publish(game, r.change);
    profilesChanged(game);
    return r;
  };
  const r = await go(to);
  const parts = [`Switched to ${to.name}`, r.change.changed.length ? summarize(r.change) : "No mods needed changing"];
  if (r.varsPending) parts.push("Mod options apply after you close the game");
  parts.push(...r.change.notes);
  if (from && from.id !== to.id) {
    record({ label: parts.join(". "), undo: () => go(from), redo: () => go(to) });
  } else {
    toast(`${parts.join(". ")}.`);
  }
}
