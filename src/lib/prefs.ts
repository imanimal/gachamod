// Preferences every screen reads and any screen can change, kept live: change one anywhere and every screen showing
// it updates at once. Stored in the app's settings (lib/api settings) so they survive restarts and travel with a
// settings export. Changes the user makes through these setters can be undone (lib/history.ts). Owner: skeleton.
import { useSyncExternalStore } from "react";
import { settings } from "./api";
import { record } from "./history";
import { t } from "./i18n";

interface Pref<T> {
  get: () => T;
  use: () => T;
  /** Set and save. `label` records an undo step for Ctrl+Z and the title bar's undo list ("Blocked Somebody"), without
   *  a toast: the control that changed it shows the new state. `say` adds a toast with Undo, for a change that reaches
   *  past what's on screen: true shows the label, a string shows those words instead (no names in toasts). */
  set: (v: T, label?: string, say?: true | string) => Promise<void>;
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
    set: async (v, label, say) => {
      const before = value;
      await save(v);
      if (label) record({ label, brief: typeof say === "string" ? say : undefined, undo: () => save(before), redo: () => save(v) }, !say);
    },
  };
  all.set(key, p as Pref<unknown>);
  return p;
}

export const jsonPref = <T>(key: string, fallback: T) => pref<T>(key, fallback, (r) => JSON.parse(r) as T, (v) => JSON.stringify(v));

// ── mods for adults ──

export type NsfwMode = "hide" | "blur" | "show";
const NSFW_LABEL: Record<NsfwMode, string> = { hide: t("Hidden"), blur: t("Blurred"), show: t("Shown") };
const NSFW_UNDO: Record<NsfwMode, string> = { hide: t("Mods for adults: hidden"), blur: t("Mods for adults: blurred"), show: t("Mods for adults: shown") };
export const nsfwPref = pref<NsfwMode>("ui.nsfw", "blur", (r) => (r === "hide" || r === "show" || r === "blur" ? r : undefined), (v) => v);
export const useNsfw = () => nsfwPref.use();
/** Change how mods for adults show, everywhere at once, with Undo. */
export function setNsfw(v: NsfwMode) {
  if (v === nsfwPref.get()) return;
  void nsfwPref.set(v, NSFW_UNDO[v]);
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
const FLAG_WORDS: Record<CreatorFlag, [(name: string) => string, (name: string) => string]> = {
  sub: [(name) => t("Following {name}", { name }), (name) => t("Stopped following {name}", { name })],
  fav: [(name) => t("Added to favourite creators: {name}", { name }), (name) => t("Removed from favourite creators: {name}", { name })],
  prio: [(name) => t("Prioritized {name}", { name }), (name) => t("Stopped prioritizing {name}", { name })],
  blocked: [(name) => t("Blocked {name}", { name }), (name) => t("Unblocked {name}", { name })],
};
// the same in toasts, which never list names
const FLAG_BRIEF: Record<CreatorFlag, [string, string]> = {
  sub: [t("Following the creator"), t("Stopped following the creator")],
  fav: [t("Added the creator to favourites"), t("Removed the creator from favourites")],
  prio: [t("Prioritized the creator"), t("Stopped prioritizing the creator")],
  blocked: [t("Blocked the creator and hid their mods"), t("Unblocked the creator")],
};

export const creatorsPref = jsonPref<Record<string, CreatorFlags>>("creators", {});
export const useCreators = () => creatorsPref.use();
export const creatorOf = (id: number | null | undefined): CreatorFlags | undefined => (id ? creatorsPref.get()[String(id)] : undefined);
export const isBlocked = (id: number | null | undefined) => !!creatorOf(id)?.blocked;

const boolPref = (key: string, fallback: boolean) =>
  pref<boolean>(key, fallback, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));
/** Creator names show what the creator set on GameBanana: name colour, font and effect, upic, hover avatar, Cubeatar,
 *  hover card style and signature. */
export const creatorStylesPref = boolPref("gb.creatorStyles", true);
export const useCreatorStyles = () => creatorStylesPref.use();
/** A creator's page takes the colours, background and fonts of their GameBanana Uberstyle. */
export const uberstylesPref = boolPref("gb.uberstyles", true);
export const useUberstyles = () => uberstylesPref.use();

/** The quickstart shortcut opens gachamod's window too. Off, only the game comes up (src-tauri background.rs reads
 *  "quickstart.open"). */
export const quickstartOpensPref = boolPref("quickstart.open", false);
/** Closing the window keeps gachamod running in the background, with a tray icon (src-tauri background.rs reads
 *  "app.background"). Unset shows as on: the first close asks (shell/CloseAsk.tsx), and quickstart stays. */
export const backgroundPref = boolPref("app.background", true);

/** Set by lib/account.ts while the user is signed in to GameBanana: following a creator follows them there too. */
let remoteFollow: ((id: number, on: boolean) => Promise<void>) | null = null;
export function setRemoteFollow(f: typeof remoteFollow) { remoteFollow = f; }

/** Turn one flag on or off for a creator, with Undo. Blocking also stops following and prioritizing. The button that
 *  did it shows the new state, so only changes that reach further toast: blocking (their mods vanish), a follow that
 *  goes to GameBanana too, and `say` for a control that goes away (a row in a list). */
export function setCreatorFlag(c: CreatorRef, flag: CreatorFlag, on: boolean, say = false) {
  const before = creatorsPref.get();
  const list = { ...before };
  const old = list[String(c.id)];
  const next: CreatorFlags = { ...(old ?? {}), id: c.id, name: c.name || old?.name || t("Member {id}", { id: String(c.id) }), avatar: c.avatar ?? old?.avatar ?? null, [flag]: on, at: Date.now() };
  if (flag === "blocked" && on) { next.sub = false; next.prio = false; next.fav = false; }
  if (flag !== "blocked" && on) next.blocked = false;
  if (flag === "prio" && on) next.sub = true;
  if (!next.sub && !next.fav && !next.prio && !next.blocked && next.seen === undefined) delete list[String(c.id)];
  else list[String(c.id)] = next;
  const [yes, no] = FLAG_WORDS[flag];
  const label = (on ? yes : no)(next.name);
  const brief = FLAG_BRIEF[flag][on ? 0 : 1];
  const blocking = flag === "blocked" && on;
  const subBefore = !!old?.sub, subAfter = !!list[String(c.id)]?.sub;
  const rf = remoteFollow;
  if (rf && subBefore !== subAfter) {
    // one request per click, and Undo sends the opposite one
    const put = async (v: Record<string, CreatorFlags>, sub: boolean) => { await creatorsPref.set(v); await rf(c.id, sub); };
    void put(list, subAfter);
    const gb = blocking ? t("Blocked the creator and unfollowed them on GameBanana") : subAfter ? t("Followed the creator on GameBanana too") : t("Unfollowed the creator on GameBanana too");
    record({ label: t("{label}, on GameBanana too", { label }), brief: gb, undo: () => put(before, subBefore), redo: () => put(list, subAfter) });
    return;
  }
  void creatorsPref.set(list, label, blocking || say ? brief : undefined);
}

/** Note the newest mod time seen for followed creators (no undo). */
export function markCreatorsSeen(times: Record<string, number>) {
  const list = { ...creatorsPref.get() };
  let changed = false;
  for (const [id, time] of Object.entries(times)) {
    const c = list[id];
    if (c && (c.seen ?? 0) < time) { list[id] = { ...c, seen: time }; changed = true; }
  }
  if (changed) void creatorsPref.set(list);
}

// ── mods hidden from Browse ("Not interested") ──

export const hiddenModsPref = jsonPref<number[]>("browse.hidden", []);
export const useHiddenMods = () => hiddenModsPref.use();
export function hideMod(id: number, name: string, hide = true) {
  const now = new Set(hiddenModsPref.get());
  if (hide) now.add(id); else now.delete(id);
  // hiding takes the card away, so it toasts with Undo; showing again is plain
  void hiddenModsPref.set([...now], hide ? t("Hid {name} from Browse", { name }) : t("Showing {name} in Browse again", { name }), hide ? t("Hid the mod from Browse") : undefined);
}

// ── custom character portraits (a mod preview or an image the user picked), per game ──

export const portraitPref = jsonPref<Record<string, string>>("portraits.custom", {});
/** Key for portraitPref: "<game>:<lowercased name>". */
export const portraitKey = (game: string, name: string) => `${game}:${name.trim().toLowerCase()}`;
export function setCustomPortrait(game: string, name: string, src: string | null) {
  const list = { ...portraitPref.get() };
  const k = portraitKey(game, name);
  if (src) list[k] = src; else delete list[k];
  // the new picture shows where it was picked; going back to the default loses the custom one, so that toasts with Undo
  void portraitPref.set(list, src ? t("New picture for {name}", { name }) : t("{name}'s picture is back to the default", { name }), src ? undefined : t("Put the default picture back"));
}
