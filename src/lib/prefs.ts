// Preferences every screen reads and any screen can change, kept live: change one anywhere and every screen showing
// it updates at once. Stored in the app's settings (lib/api settings) so they survive restarts and travel with a
// settings export. Changes the user makes through these setters can be undone (lib/history.ts). Owner: skeleton.
import { useSyncExternalStore } from "react";
import { settings } from "./api";
import { record } from "./history";

interface Pref<T> {
  get: () => T;
  use: () => T;
  /** Set and save. `label` records an undo step with that label ("Blocked Somebody"). */
  set: (v: T, label?: string) => Promise<void>;
  /** Resolves once the saved value has been read. */
  ready: Promise<void>;
}

const all = new Map<string, Pref<unknown>>();

/** A preference saved under `key`, parsed with `parse` (bad values fall back). */
export function pref<T>(key: string, fallback: T, parse: (raw: string) => T | undefined, write: (v: T) => string): Pref<T> {
  const hit = all.get(key);
  if (hit) return hit as Pref<T>;
  let value = fallback;
  let touched = false;
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((f) => f());
  // read on first use, not at import time (the demo backend registers itself after the modules load)
  let loading: Promise<void> | null = null;
  const load = () => loading ??= settings.get(key).then((raw) => {
    if (raw === null || raw === undefined || touched) return;
    try { const v = parse(raw); if (v !== undefined) { value = v; emit(); } } catch { /* keep the fallback */ }
  }).catch(() => {});
  const sub = (f: () => void) => { void load(); subs.add(f); return () => { subs.delete(f); }; };
  const save = async (v: T) => { touched = true; value = v; emit(); await settings.set(key, write(v)); };
  const p: Pref<T> = {
    get: () => { void load(); return value; },
    use: () => useSyncExternalStore(sub, () => value),
    get ready() { return load(); },
    set: async (v, label) => {
      const before = value;
      await save(v);
      if (label) record({ label, undo: () => save(before), redo: () => save(v) });
    },
  };
  all.set(key, p as Pref<unknown>);
  return p;
}

export const jsonPref = <T>(key: string, fallback: T) => pref<T>(key, fallback, (r) => JSON.parse(r) as T, (v) => JSON.stringify(v));

// ── mods for adults ──

export type NsfwMode = "hide" | "blur" | "show";
const NSFW_LABEL: Record<NsfwMode, string> = { hide: "Hidden", blur: "Blurred", show: "Shown" };
export const nsfwPref = pref<NsfwMode>("ui.nsfw", "blur", (r) => (r === "hide" || r === "show" || r === "blur" ? r : undefined), (v) => v);
export const useNsfw = () => nsfwPref.use();
/** Change how mods for adults show, everywhere at once, with Undo. */
export function setNsfw(v: NsfwMode) {
  if (v === nsfwPref.get()) return;
  void nsfwPref.set(v, `Mods for adults: ${NSFW_LABEL[v].toLowerCase()}`);
}
export const nsfwLabel = (v: NsfwMode) => NSFW_LABEL[v];

// ── creators (GameBanana members): follow, favourite, prioritize, block ──

export interface CreatorRef { id: number; name: string; avatar?: string | null }
export interface CreatorFlags extends CreatorRef {
  /** New mods from them show on Home and get a count. */
  sub?: boolean;
  /** Starred: listed first among your creators. */
  fav?: boolean;
  /** Their mods come first in Browse and always count as high quality. */
  prio?: boolean;
  /** Their mods never show. */
  blocked?: boolean;
  /** When a flag last changed (unix ms). */
  at?: number;
  /** Newest mod time already seen (unix s), for the "new from creators you follow" count. */
  seen?: number;
}
export type CreatorFlag = "sub" | "fav" | "prio" | "blocked";
const FLAG_WORDS: Record<CreatorFlag, [string, string]> = {
  sub: ["Following", "Stopped following"], fav: ["Added to favourite creators:", "Removed from favourite creators:"],
  prio: ["Prioritized", "Stopped prioritizing"], blocked: ["Blocked", "Unblocked"],
};

export const creatorsPref = jsonPref<Record<string, CreatorFlags>>("creators", {});
export const useCreators = () => creatorsPref.use();
export const creatorOf = (id: number | null | undefined): CreatorFlags | undefined => (id ? creatorsPref.get()[String(id)] : undefined);
export const isBlocked = (id: number | null | undefined) => !!creatorOf(id)?.blocked;

/** Turn one flag on or off for a creator, with Undo. Blocking also stops following and prioritizing. */
/** Set by lib/account.ts while the user is signed in to GameBanana: following a creator follows them there too. */
let remoteFollow: ((id: number, on: boolean) => Promise<void>) | null = null;
export function setRemoteFollow(f: typeof remoteFollow) { remoteFollow = f; }

export function setCreatorFlag(c: CreatorRef, flag: CreatorFlag, on: boolean) {
  const before = creatorsPref.get();
  const list = { ...before };
  const old = list[String(c.id)];
  const next: CreatorFlags = { ...(old ?? {}), id: c.id, name: c.name || old?.name || `Member ${c.id}`, avatar: c.avatar ?? old?.avatar ?? null, [flag]: on, at: Date.now() };
  if (flag === "blocked" && on) { next.sub = false; next.prio = false; next.fav = false; }
  if (flag !== "blocked" && on) next.blocked = false;
  if (flag === "prio" && on) next.sub = true;
  if (!next.sub && !next.fav && !next.prio && !next.blocked && next.seen === undefined) delete list[String(c.id)];
  else list[String(c.id)] = next;
  const [yes, no] = FLAG_WORDS[flag];
  const label = `${on ? yes : no} ${next.name}`;
  const subBefore = !!old?.sub, subAfter = !!list[String(c.id)]?.sub;
  const rf = remoteFollow;
  if (rf && subBefore !== subAfter) {
    // one request per click, and Undo sends the opposite one
    const put = async (v: Record<string, CreatorFlags>, sub: boolean) => { await creatorsPref.set(v); await rf(c.id, sub); };
    void put(list, subAfter);
    record({ label: `${label}, on GameBanana too`, undo: () => put(before, subBefore), redo: () => put(list, subAfter) });
    return;
  }
  void creatorsPref.set(list, label);
}

/** Note the newest mod time seen for followed creators (no undo). */
export function markCreatorsSeen(times: Record<string, number>) {
  const list = { ...creatorsPref.get() };
  let changed = false;
  for (const [id, t] of Object.entries(times)) {
    const c = list[id];
    if (c && (c.seen ?? 0) < t) { list[id] = { ...c, seen: t }; changed = true; }
  }
  if (changed) void creatorsPref.set(list);
}

// ── mods hidden from Browse ("Not interested") ──

export const hiddenModsPref = jsonPref<number[]>("browse.hidden", []);
export const useHiddenMods = () => hiddenModsPref.use();
export function hideMod(id: number, name: string, hide = true) {
  const now = new Set(hiddenModsPref.get());
  if (hide) now.add(id); else now.delete(id);
  void hiddenModsPref.set([...now], hide ? `Hid ${name} from Browse` : `Showing ${name} in Browse again`);
}

// ── custom character portraits (a mod preview or an image the user picked), per game ──

export const portraitPref = jsonPref<Record<string, string>>("portraits.custom", {});
/** Key for portraitPref: "<game>:<lowercased name>". */
export const portraitKey = (game: string, name: string) => `${game}:${name.trim().toLowerCase()}`;
export function setCustomPortrait(game: string, name: string, src: string | null) {
  const list = { ...portraitPref.get() };
  const k = portraitKey(game, name);
  if (src) list[k] = src; else delete list[k];
  void portraitPref.set(list, src ? `New picture for ${name}` : `${name}'s picture is back to the default`);
}
