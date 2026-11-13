// Profiles for the screens that show them (Profiles, the sidebar switch): the list, a bus so both stay in step, the
// game's character portraits for "char:<Name>" icons, and switching with Undo. Owner: LIBRARY area.
import { useCallback, useEffect, useState } from "react";
import { characters, errorText, profiles, type Character, type GameId, type Profile } from "../../lib/api";
import { record } from "../../lib/history";
import { toast } from "../../ui/toast";
import { publish, summarize } from "../library/data";

const subs = new Set<(game: GameId) => void>();
/** Tell every profile list for this game to reload. */
export function profilesChanged(game: GameId) { subs.forEach((f) => f(game)); }

export function useProfiles(game: GameId | undefined) {
  const [list, setList] = useState<Profile[] | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!game) { setList(null); return; }
    let live = true;
    profiles.list(game).then((l) => { if (live) setList(l); }).catch((e) => { if (live) { setList((x) => x ?? []); toast(errorText(e), true); } });
    return () => { live = false; };
  }, [game, tick]);
  useEffect(() => {
    const f = (g: GameId) => { if (g === game) reload(); };
    subs.add(f);
    return () => { subs.delete(f); };
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
